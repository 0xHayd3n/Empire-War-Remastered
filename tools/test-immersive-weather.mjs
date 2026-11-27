import assert from 'node:assert/strict';
import { Color, Matrix3, Vector2 } from 'three';
import { proceduralLandSky } from '../public/js/game/procedural-land-sky.js';
import { ImmersiveWeather, useWeatherLibrary, weatherContext } from '../public/js/immersive-weather.js';

const rig = Object.fromEntries(
  ['sunColor', 'sunSpecular', 'ambient', 'fillColor', 'fillColor2', 'fogTint', 'fogRange', 'orbitPos', 'orbitNeg'].map(key => [
    key,
    { value: key === 'fogRange' ? new Vector2(900, 3000) : key.startsWith('orbit') ? new Matrix3() : new Color(0.62, 0.45, 0.41) }
  ])
);
const original = JSON.stringify(rig),
  library = new ImmersiveWeather();
const env = (scenario = '', name = 'Noon_Clear', sky = 'Day_Storm_Sky') => weatherContext({ name, weather: scenario }, sky);
function draw(ctx, wx) {
  const initial = JSON.stringify(wx);
  const active = library.begin(rig, ctx, wx);
  let result = null;
  if (active) {
    const U = library.uniforms;
    result = {
      sky: U.wxZenith.value.toArray(),
      horizon: U.wxHorizon.value.toArray(),
      glare: U.wxOptics.value.x,
      key: rig.sunColor.value.r,
      keyRGB: rig.sunColor.value.toArray(),
      dustAir: library.dustAir.value.toArray(),
      near: rig.fogRange.value.x,
      fill: rig.fillColor.value.r,
      distance: rig.fogRange.value.y
    };
    assert.deepEqual(rig.fillColor2.value.toArray(), [0.62, 0.45, 0.41]);
    library.end(rig);
  }
  assert.equal(JSON.stringify(rig), original);
  assert.equal(library.dustAir.value.w, 0);
  assert.equal(JSON.stringify(wx), initial);
  return result;
}
const phase = (name, level = 1) => ({ name, level, phases: [{ name, strength: level }] });
const clear = draw(env(), phase('clear', 0)),
  rain = draw(env('RAIN_RANDOM'), phase('rain'));
assert(clear.sky[2] > clear.sky[0] * 4);
assert(clear.glare > 0.8);
assert(clear.key / clear.fill > 1.9);
assert(rain.key < clear.key / 3);
assert(rain.distance < clear.distance);
const snow = draw(env('SNOW_RANDOM'), phase('snow')),
  blizzard = draw(env('BLIZZARD_RANDOM'), phase('snow'));
assert(blizzard.distance < snow.distance && blizzard.key < snow.key && blizzard.glare < snow.glare);
assert.deepEqual(draw(env('SNOW_RANDOM'), { ...phase('snow'), emitter: 'P_Snowblizzard.alo' }), blizzard);
assert.deepEqual(draw(env('BLIZZARD_RANDOM'), { ...phase('snow'), emitter: 'P_SnowSleet.alo' }), snow);
const sand = draw(env('SANDSTORM_TUTORIAL'), phase('sandstorm')),
  ash = draw(env('ASH_RANDOM'), phase('ash'));
// Warm but not rust-orange. Soften shadows by raising diffuse light, not by removing
// most green and blue from the incident sun; attenuate the distance, not the foreground.
assert(sand.horizon[0] > sand.horizon[2] && sand.horizon[0] < 1.3 * sand.horizon[2]);
const gain = sand.keyRGB.map((c, i) => c / [0.62, 0.45, 0.41][i]);
assert(Math.min(...gain) > 0.94 && Math.max(...gain) / Math.min(...gain) < 1.1);
assert(sand.fill > sand.key && sand.key < clear.key && sand.distance < clear.distance && sand.near < 0.1 * sand.distance);
assert.deepEqual(sand.dustAir, [...sand.horizon.slice(0, 3), 1]);
for (const p of [clear, rain, snow, blizzard, ash]) assert.equal(p.dustAir[3], 0);
const dustPhases = [
  { name: 'sandstorm', strength: 1 },
  { name: 'clear', strength: 0 }
];
for (const [i, amount] of [
  [0, 0.75],
  [1, 0.25]
]) {
  const during = draw(env('SANDSTORM_RANDOM'), { out: true, i, ease: 4, left: 3, phases: dustPhases });
  assert.equal(during.dustAir[3], amount);
}
assert.deepEqual(draw(env('SANDSTORM_RANDOM'), phase('sandstorm', 0)), clear);
const dustNight = draw(env('SANDSTORM_RANDOM', 'Nighttime_Sandstorm'), phase('sandstorm'));
assert(dustNight.dustAir[0] < sand.dustAir[0] * 0.4 && dustNight.glare === 0);
assert(ash.sky[0] < sand.sky[0]);
const dawn = draw(env('', 'Sunrise_Clear'), phase('clear', 0));
assert(dawn.horizon[0] > dawn.horizon[2] && dawn.key < clear.key);
const night = env('BLIZZARD_RANDOM', 'Nighttime_Snow');
const clearNight = draw(night, phase('clear', 0));
assert(clearNight.sky[2] < 0.15 && clearNight.glare === 0);
const whiteNight = draw(night, phase('snow'));
assert.equal(whiteNight.glare, 0);
assert(whiteNight.sky[0] < blizzard.sky[0] * 0.4);
for (const ctx of [env('', 'Cinematic'), env('', 'Noon_Clear', 'Girder_Sky_Interior')]) assert.equal(ctx, null);
const lava = draw(env('', 'Clear', 'Volcanic_Orange'), phase('clear', 0));
assert(lava.horizon[0] > 2 * lava.horizon[2]);
for (const sky of ['Workshop_Sky', '']) assert.deepEqual(draw(env('UNKNOWN', 'Noon_Clear', sky), phase('custom')), clear);
assert.deepEqual(draw(weatherContext(null), phase('clear', 0)), clear);
assert(draw(env(), phase('downpour')).distance < rain.distance);
assert(draw(env(), phase('drizzle')).key > rain.key);
assert(draw(env(), phase('sleet')).distance < snow.distance);
assert.deepEqual(draw(env(), { ...phase('rain'), lightning: 0.25 }), draw(env(), phase('thunderstorm')));
assert(draw(env(), phase('fog')).distance < draw(env(), phase('overcast')).distance);
const custom = weatherContext({ name: 'Dantooine', skyAngles: { THRREV_REDSUNSET: [], PLANET_RINGS00: [] } }, '', { file: 'workshop.ted' });
assert(custom.rings && custom.base.horizon[0] > custom.base.horizon[2]);
const dome = proceduralLandSky(custom, library, { value: null }, [12, -6]);
const mesh = dome.sky.children[0];
assert.equal(mesh.geometry.type, 'BoxGeometry');
assert(!Object.values(mesh.material.uniforms).some(u => u.value?.isTexture));
dome.update(20);
const skyAt20 = mesh.material.uniforms.skyFlow.value.toArray();
dome.update(27);
assert.notDeepEqual(mesh.material.uniforms.skyFlow.value.toArray(), skyAt20);
dome.update(20);
assert.deepEqual(mesh.material.uniforms.skyFlow.value.toArray(), skyAt20);
dome.dispose();
assert.equal(dome.sky.children.length, 0);
// No 50% gameplay cutoff, and no jump at phase rollover. Type-to-type transitions blend
// both endpoint looks instead of recoloring the outgoing emitter at its interpolated strength.
const phases = [
  { name: 'clear', strength: 0 },
  { name: 'rain', strength: 1 }
];
for (const i of [0, 1])
  for (const left of [5, 4.9, 2.5, 0]) {
    const p = draw(env('RAIN_RANDOM'), { name: phases[i].name, out: true, i, ease: 5, left, phases });
    const k = i === 0 ? 1 - left / 5 : left / 5;
    assert(Math.abs(p.key - (clear.key * (1 - k) + rain.key * k)) < 1e-6);
  }
assert.deepEqual(draw(env('RAIN_RANDOM'), phase('rain', 0)), clear);
assert.deepEqual(draw(env('RAIN_RANDOM'), phase('rain', 0.5)), draw(env('RAIN_RANDOM'), { out: true, i: 0, ease: 5, left: 2.5, phases }));
for (const [mode, stock, remaster, want] of [
  ['all', false, false, true],
  ['all', true, false, true],
  ['remasters', true, true, true],
  ['remasters', true, false, false],
  ['stock', true, false, true],
  ['stock', false, true, false],
  ['off', true, true, false],
  ['other', true, true, false]
])
  assert.equal(useWeatherLibrary(mode, stock, remaster), want);
console.log('Weather library: all stock phases, daylight/night, easing, original restoration and scope passed.');
