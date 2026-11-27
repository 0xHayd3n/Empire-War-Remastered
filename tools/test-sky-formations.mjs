import assert from 'node:assert/strict';
import { ImmersiveWeather, weatherContext } from '../public/js/immersive-weather.js';
import { skyFormations } from '../public/js/sky-formations.js';
const weather = new ImmersiveWeather();
const context = (world, name, scenario = '') =>
  weatherContext({ name, weather: scenario }, '', { file: `_MP_LAND_${world}.TED`, planet: world });
const clear = { name: 'clear', level: 0 };
function sample(ctx, wx, time) {
  weather.sample(ctx, Object.freeze(wx), time);
  const { wxFormation, wxPhenomena } = weather.uniforms;
  return [...wxFormation.value.toArray(), ...wxPhenomena.value.toArray()];
}
const key = a => a.map(x => x.toFixed(4)).join(':');
const signatures = new Map(Object.entries(skyFormations).map(([name, f]) => [key([...f.shape, ...f.optics]), name]));
assert.equal(signatures.size, 24, 'Catalogue must contain distinct formations, not duplicate aliases');
const found = new Set();
function visit(ctx, wx) {
  const seen = new Set();
  for (let sec = 0; sec < 960; sec += 12) {
    const v = sample(ctx, wx, sec);
    assert(v.every(x => Number.isFinite(x) && x >= 0 && x <= 1 + 1e-8));
    const form = signatures.get(key(v));
    if (form) {
      found.add(form);
      seen.add(form);
    }
  }
  return seen;
}
// Actual stock names/scenario families, not a run over the library's own keys. Hold a phase
// to exercise its repertoire; actual maps retain their shorter/longer authored durations.
const endor = context('Endor', 'Noon_Rain', 'RAIN_RANDOM'),
  hoth = context('Hoth', 'Noon_Snow', 'SNOW_RANDOM'),
  night = context('Hoth', 'Nighttime_Snow', 'SNOW_RANDOM'),
  polus = context('Polus', 'Noon_Snow', 'BLIZZARD_RANDOM'),
  tatooine = context('Tatooine', 'Noon_Sandstorm', 'SANDSTORM_RANDOM'),
  ash = context('Shola', 'Noon_Ash', 'ASH_RANDOM');
for (const [ctx, wx] of [
  [endor, clear],
  [context('Endor', 'Sunrise_Clear'), clear],
  [context('Tatooine', 'Sunrise_Sandstorm'), clear],
  [context('Yavin', 'Sunrise_Rain'), clear],
  [hoth, clear],
  [night, clear],
  [tatooine, clear],
  [tatooine, { name: 'sandstorm', level: 1 }],
  [endor, { name: 'rain', level: 1 }],
  [endor, { name: 'rain', level: 1, lightning: 0.5 }],
  [hoth, { name: 'snow', level: 1 }],
  [polus, { name: 'snow', level: 1 }],
  [ash, { name: 'ash', level: 1 }]
])
  visit(ctx, wx);
assert(found.size >= 21, `Only ${found.size} distinct formations reachable from stock conditions`);
for (const name of [
  'open',
  'maresTails',
  'rainCurtains',
  'squallLine',
  'anvil',
  'snowBands',
  'whiteout',
  'dustFront',
  'ashPlumes',
  'auroralArc'
])
  assert(found.has(name), name);
const stockCount = found.size;
for (const name of ['overcast', 'drizzle', 'mist', 'haze', 'downpour', 'fog', 'sleet']) visit(endor, { name, level: 1 });
assert.deepEqual([...found].sort(), [...signatures.values()].sort());
// Same clock, same sky, independent of frame order. Sub-second ticks don't cut between shapes.
for (const ctx of [endor, tatooine, night]) {
  const a = sample(ctx, clear, 83);
  sample(ctx, clear, 440);
  assert.deepEqual(sample(ctx, clear, 83), a);
  let prev = sample(ctx, clear, 0);
  for (let t = 1; t < 450; t++) {
    const next = sample(ctx, clear, t);
    assert(next.every((x, i) => Math.abs(x - prev[i]) < 0.035));
    prev = next;
  }
}
assert.notEqual(endor.patternSeed, context('Endor', 'Sunrise_Rain', 'RAIN_RANDOM').patternSeed);
for (let t = 0; t <= 800; t += 19) {
  assert.equal(sample(endor, clear, t)[6], 0);
  assert.equal(sample(hoth, clear, t)[6], 0);
  assert.equal(sample(night, { name: 'snow', level: 1 }, t)[6], 0);
  assert.equal(sample(tatooine, { name: 'sandstorm', level: 1 }, t)[5], 0);
}
const phases = Object.freeze([
  { name: 'snow', strength: 0.15 },
  { name: 'snow', strength: 1 }
]);
const a = sample(hoth, { name: 'snow', level: 0.15 }, 33),
  b = sample(hoth, { name: 'snow', level: 1 }, 33);
for (const left of [0, 2.5, 5]) {
  const m = sample(hoth, { phases, i: 0, ease: 5, left, out: true }, 33);
  assert(m.every((x, i) => Math.abs(x - ((left / 5) * a[i] + (1 - left / 5) * b[i])) < 1e-7));
}
console.log(
  `${stockCount} formations reachable from stock phase families; all ${found.size} in the library. Clock, climate and transition guards passed.`
);
