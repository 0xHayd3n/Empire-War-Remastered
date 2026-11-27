// Transient failure must not disable material reflections until the player changes map.
import assert from 'node:assert/strict';
import * as T from 'three';
import { renderSkyAtlas } from '../public/js/skyreflect.js';
import { landFinish, landSkyFaces, weatherProbeDue } from '../public/js/game/land-sky-light.js';
const sky = new T.Scene();
sky.add(new T.Group());
const view = { sky, skyAtlasState: { left: 0 }, map: { environment: {} } };
let calls = 0,
  reject = true,
  clock = 100;
Object.defineProperty(performance, 'now', { configurable: true, value: () => clock });
const r = {
  getRenderTarget: () => null,
  setRenderTarget() {},
  clear() {},
  render() {},
  async readRenderTargetPixelsAsync(t, x, y, w, h, bytes) {
    calls++;
    if (reject) throw Error('unavailable');
    bytes.fill(140);
  }
};
renderSkyAtlas(r, sky);
const tick = () => new Promise(setImmediate);
async function waitForTexture() {
  const until = Date.now() + 10000;
  while (!view.landFinish.texture && Date.now() < until) await new Promise(r => setTimeout(r, 5));
}
try {
  assert.equal(landFinish(view, r), null);
  await tick();
  for (let i = 0; i < 20; i++) landFinish(view, r);
  assert.equal(calls, 1, 'no readback storm');
  reject = false;
  clock += 4000;
  assert.equal(landFinish(view, r), null);
  await waitForTexture();
  assert(landFinish(view, r)?.isTexture, 'next eligible draw must recover the land probe');
  assert.equal(calls, 2);
  view.landFinish.texture.dispose();
  view.landFinish = null;
  reject = true;
  for (let i = 0; i < 15; i++) {
    clock += 8000;
    landFinish(view, r);
    await tick();
  }
  assert(calls - 2 <= 3, 'bound retries for a persistently failing target');
  reject = false;
  view.landFinish = null;
  const prior = calls;
  landSkyFaces(view, r);
  landFinish(view, r);
  await waitForTexture();
  assert.equal(calls - prior, 1, 'sky bounce and material reflections must share a capture readback');
  assert(view.landProbe.faces && view.landFinish.texture);
  view.landFinish.texture.dispose();
} finally {
  delete performance.now;
}
// A five-second transition that crosses the colour threshold should submit only its
// settled probe, not cancel and restart the convolution halfway through the fade.
const last = { nextSample: 4, color: new T.Vector3() },
  target = new T.Vector3();
for (let t = 20; t < 25; t += 0.25) {
  target.setScalar((t - 20) / 5);
  assert(!weatherProbeDue(last, target, t, { out: true, left: 25 - t, ease: 5 }));
}
assert(weatherProbeDue(last, target, 25, { out: false }));
last.color.copy(target);
last.nextSample = 29;
assert(!weatherProbeDue(last, target, 40, { out: false }));
assert(!weatherProbeDue(last, target.setScalar(0), 38, { out: true, left: 25, ease: 60 }));
assert(weatherProbeDue(last, target, 41, { out: true, left: 22, ease: 60 }));
console.log('PASS bounded and shared sky readbacks; short fades coalesced; long fades stay current');
