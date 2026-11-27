import assert from 'node:assert/strict';
import { lowland, airDensity, airborne, leafy, windVector, gust } from '../public/js/battlefield.js';
import { battlePrefs } from '../public/js/battlerealism.js';
assert.equal(lowland({ heights: [NaN, 300, 20, 10, 90] }), 20);
assert.equal(lowland({}), 0);
const fog = { on: true, end: 3500 };
assert(airDensity(fog, 1) > airDensity(fog, 0));
assert.equal(airDensity({ on: false, end: 100 }, 1), 0);
assert.equal(airDensity(null, 1), 0);
const out = new Float32Array(4),
  clouds = { texture: 'cloud', drift: [0, 15, 0] };
for (const c of [null, { ...clouds, texture: '' }, { ...clouds, drift: [0, 0, 0] }])
  assert.deepEqual([...windVector(c, 33, {}, out)], [0, 0, 0, 0]);
windVector(clouds, 31, { level: 0 }, out);
assert(out[1] < 0 && out[0] === 0 && out[3] === 1);
const first = gust(100, 20, out),
  s = out[1];
windVector(clouds, 31, { level: 0 }, out);
assert.equal(first, gust(100, 20, out));
windVector(clouds, 33, { level: 1 }, out);
assert.notEqual(first, gust(100, 20, out));
assert(Math.abs(out[1] / s - 1.35) < 1e-6);
for (const s of ['grass.fx', 'tree.fx']) assert(leafy(s, 'foo'));
assert(leafy('meshalpha.fx', 'fern_a'));
assert(!leafy('meshalpha.fx', 'team_banner'));
assert(!leafy('meshgloss.fx', 'steel'));
for (const key of ['particle_smoke', 'p_walker_footpuff_dirt']) assert(airborne({}, key));
for (const key of ['P_Dust_Splash', 'Smoke_Muzzle', 'P_SmokeLaser']) assert(!airborne({}, key));
for (const k of ['heat', 'weather', 'objectSpace', 'slave', 'stretch']) assert(!airborne({ [k]: true }, 'smoke'));
assert(airborne({ wind: true, blend: 0 }, 'unnamed'));
assert(!airborne({ wind: true, blend: 1 }, 'unnamed'));
for (const key of ['aerialDepth', 'sharedWind', 'steadyDetail']) {
  const p = { battleRealism: 'on', [key]: false };
  assert.equal(battlePrefs(p)[key], true);
  p.battleRealism = 'off';
  p[key] = true;
  assert.equal(battlePrefs(p)[key], false);
  p.battleRealism = 'custom';
  assert.equal(battlePrefs(p)[key], true);
}
console.log('Battlefield: map fog/lowlands, still sky, gust direction/clock, material/particle guards and master isolation passed.');
