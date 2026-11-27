import assert from 'node:assert/strict';
import { ForestWeather } from '../public/js/endor-weather.js';
import { GroundRain } from '../public/js/groundrain.js';
const phase = Object.freeze({ name: 'rain', level: 1 });
const mute = Object.freeze({ name: 'clear', level: 0, emitter: 'p_rain_med00.alo' });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
function walk(dt) {
  const weather = new ForestWeather(),
    bed = new GroundRain();
  for (let n = 0; n < 30 / dt; n++) weather.update(phase, dt, bed.update(phase, dt));
  return weather;
}
const wet = walk(0.125),
  coarse = walk(1);
near(wet.cover, coarse.cover);
near(wet.wet, coarse.wet);
let before = wet.cover;
wet.update(phase, 0, wet.wet);
assert.equal(wet.cover, before);
wet.update(mute, 4, wet.wet - 0.05);
assert.equal(wet.rain, 0);
assert(wet.wet > 0.75 && wet.cover > 0 && wet.cover < before);
for (const name of ['ash', 'snow', 'clear']) {
  const f = new ForestWeather();
  f.update({ name, level: 1, emitter: mute.emitter }, 30, 0);
  assert.equal(f.cover, 0);
}
const transition = Object.freeze({
  phases: Object.freeze([Object.freeze({ name: 'clear', strength: 0 }), Object.freeze({ name: 'rain', strength: 1 })]),
  i: 0,
  ease: 10,
  left: 5,
  out: true
});
const f = new ForestWeather();
f.update(transition, 3, 0.2);
assert.equal(f.rain, 0.5);
class Color {
  constructor(r, g, b) {
    this.setRGB(r, g, b);
  }
  setRGB(r, g, b) {
    this.r = r;
    this.g = g;
    this.b = b;
    return this;
  }
  clone() {
    return new Color(this.r, this.g, this.b);
  }
  copy(c) {
    return this.setRGB(c.r, c.g, c.b);
  }
  multiplyScalar(s) {
    return this.setRGB(this.r * s, this.g * s, this.b * s);
  }
}
const L = {
  forestWeather: {
    value: {
      set(...v) {
        this.v = v;
      }
    }
  }
};
for (const k of ['sunColor', 'sunSpecular', 'fillColor', 'ambient', 'fogTint', 'fillColor2']) L[k] = { value: new Color(0.8, 0.9, 1) };
const snapshot = () => JSON.stringify(Object.entries(L).slice(1));
const orig = snapshot();
for (let i = 0; i < 3; i++) {
  f.begin(L, 1, false, false);
  assert(L.sunColor.value.r < 0.8);
  assert.equal(L.fillColor2.value.r, 0.8);
  assert.equal(L.fogTint.value.g, 0.9);
  assert.deepEqual(L.forestWeather.value.v.slice(2), [0, 0]);
  f.end(L);
  assert.equal(snapshot(), orig);
  assert.deepEqual(L.forestWeather.value.v, [0, 0, 0, 0]);
}
console.log('Endor forecast: rain-only easing, pause, frame-rate independence, residual wetness and temporary lighting passed');
