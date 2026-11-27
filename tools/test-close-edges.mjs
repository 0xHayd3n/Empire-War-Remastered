import assert from 'node:assert/strict';
import { closeEdgeDensity as density } from '../public/js/closeedges.js';
const on = { closeHullEdges: true, aa: true, battleScale: 1, supersample: 1, scale: 1 };
assert.equal(density(true, on, 1920, 1080), 1.5);
assert.equal(density(true, on, 1920, 1080, 8192, true), 4 / 3);
assert.equal(density(false, on, 1920, 1080), 1);
for (const p of [{ closeHullEdges: false }, { aa: false }, { battleScale: 0.77 }, { supersample: 1.5 }, { scale: 0.75 }])
  assert.equal(density(true, { ...on, ...p }, 1920, 1080), 1);
assert.equal(density(true, on, 3840, 2160), 1);
assert.equal(density(true, on, 6800, 864, 7000), 1);
const d = density(true, on, 3200, 1800);
assert(d > 1 && d < 1.5 && Math.floor(3200 * d) * Math.floor(1800 * d) <= 3840 * 2160);
console.log('Close-up coverage: near/native gates, backend caps, texture extent and UHD budget passed');
