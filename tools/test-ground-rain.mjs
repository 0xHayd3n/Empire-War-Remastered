import assert from 'node:assert/strict';
import { rainfall, wetStep, wetSurface, MovementDust } from '../public/js/groundrain.js';
import { battlePrefs } from '../public/js/battlerealism.js';
const rain = { name: 'rain', strength: 1 },
  clear = { name: 'clear', strength: 0 };
assert.equal(rainfall({ name: 'ash', level: 1, emitter: 'p_rain_of_ash.alo' }), 0);
for (const name of ['snow', 'sandstorm', 'clear', 'unknown']) assert.equal(rainfall({ name, level: 1 }), 0);
assert.equal(rainfall({ phases: [rain, clear], i: 0, out: true, left: 2, ease: 8 }), 0.25);
assert.equal(rainfall({ phases: [clear, rain], i: 0, out: true, left: 2, ease: 8 }), 0.75);
const soaked = wetStep(0, 1, 30);
assert(soaked > 0.8 && soaked < 1);
assert.equal(wetStep(soaked, 0, 0), soaked);
assert.equal(wetStep(soaked, 0, 72), 0);
assert(wetStep(soaked, 0, 5) > 0.7);
for (const rain of [0, 0.08, 0.5, 1]) {
  let v = soaked;
  for (let j = 0; j < 240; j++) v = wetStep(v, rain, 1 / 60);
  assert(Math.abs(v - wetStep(soaked, rain, 4)) < 1e-9);
}
const profile = (kind, texture) => wetSurface({ kind, texture });
assert(profile(2, 'alt.dds')[0] > profile(5, 'alt.dds')[0]);
assert(profile(5, 'alt.dds')[1] > 8 * profile(0, 'W_TempRockGrn01.tga')[1]);
assert(profile(0, 'modXYZ.dds')[1] < 0.05);
assert.deepEqual(profile(8, 'fire.dds'), [0, 0]);
const dust = new MovementDust(),
  u = {};
for (const p of ['AT_AT_FootPuff_Water', 'AT_AT_FootPuff_Snow', 'Tank_Fire', 'Splash_Wake', 'FXMod']) assert(dust.emit(u, p, 1));
const count = w => Array.from({ length: 100 }, () => dust.emit(u, 'AT_AT_FootPuff_Dirt', w)).filter(Boolean).length;
assert.equal(count(0), 100);
assert(count(0.9) < 25);
assert.equal(battlePrefs({ battleRealism: 'on' }).rainSurfaces, true);
assert.equal(battlePrefs({ battleRealism: 'off', rainSurfaces: true }).rainSurfaces, false);
console.log('Rain-only phase easing, frame-rate independent accumulation/drying, wet materials, movement-dust selection and settings: ok');
