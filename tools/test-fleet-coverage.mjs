import assert from 'node:assert/strict';
import { fleetSampleRatio } from '../public/js/fleetcoverage.js';
const prefs = { fleetCoverage: true, aa: true, scale: 1, battleScale: 1, supersample: 1 };
assert.equal(fleetSampleRatio(prefs, 1920, 1080), 1.5);
assert.equal(fleetSampleRatio(prefs, 1920, 1080, 8192, true), 1.25);
for (const changed of [{ fleetCoverage: false }, { aa: false }, { scale: 0.75 }, { supersample: 1.5 }, { battleScale: 0.9 }])
  assert.equal(fleetSampleRatio({ ...prefs, ...changed }, 1280, 720), 1);
assert.equal(fleetSampleRatio(prefs, 3840, 2160), 1);
assert.equal(fleetSampleRatio(prefs, 1920, 1080, 2048), 1);
for (const [w, h] of [
  [2143, 1173],
  [2560, 1440],
  [3200, 620],
  [621, 3291]
]) {
  const r = fleetSampleRatio(prefs, w, h, 4096);
  assert(Math.floor(w * r) * Math.floor(h * r) <= 2880 * 1620 && Math.max(w, h) * r <= 4096);
}
console.log('Fleet coverage: frame budget, backend, native scale and dimension guards passed.');
