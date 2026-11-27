// Exercise the real sky readback boundary, including a sky switch while filtering.
import assert from 'node:assert/strict';
import * as T from 'three';
import { renderSkyAtlas } from '../public/js/skyreflect.js';
import { filterFinishAtlas } from '../public/js/finishatlas.js';
import { landFinish } from '../public/js/game/land-sky-light.js';
const jobs = [];
class WorkerDouble {
  constructor() {
    jobs.push(this);
  }
  postMessage({ pixels, size }) {
    this.input = pixels;
    this.size = size;
  }
  terminate() {
    this.stopped = true;
  }
  finish() {
    this.onmessage?.({ data: filterFinishAtlas(this.input, this.size) });
  }
}
globalThis.Worker = WorkerDouble;
const sky = new T.Scene();
sky.add(new T.Group());
const view = { sky, skyAtlasState: { left: 0 }, map: { environment: {} } };
const r = {
  getRenderTarget: () => null,
  setRenderTarget() {},
  clear() {},
  render() {},
  async readRenderTargetPixelsAsync(t, x, y, w, h, bytes) {
    bytes.forEach((_, i) => (bytes[i] = (17 * i + (i >> 5)) & 255));
  }
};
renderSkyAtlas(r, sky);
const tick = () => new Promise(setImmediate);
landFinish(view, r);
await tick();
assert.equal(jobs.length, 1, 'land reflection convolution is still running on the render thread');
assert(!view.landFinish.texture);
const stale = view.landFinish;
view.map.environment = {};
landFinish(view, r);
await tick();
assert(jobs[0].stopped, 'obsolete sky job not cancelled');
assert.equal(jobs.length, 2);
jobs[0].finish();
await tick();
assert(!stale.texture && !view.landFinish.texture);
jobs[1].finish();
await tick();
const tex = landFinish(view, r);
assert(tex?.isTexture);
assert.deepEqual(tex.image.data, filterFinishAtlas(jobs[1].input, jobs[1].size));
assert(jobs[1].stopped);
const expected = tex.image.data;
view.map.environment = {};
landFinish(view, r);
await tick();
jobs[2].onerror({ preventDefault() {} });
assert(!view.landFinish.texture && view.landFinish.cancel, 'worker failure must yield, not block the draw with a full convolution');
const until = Date.now() + 10000;
while (!view.landFinish.texture && Date.now() < until) await new Promise(r => setTimeout(r, 8));
assert(jobs[2].stopped);
assert.deepEqual(landFinish(view, r).image.data, expected, 'worker load failure lost reflections');
view.landFinish.texture.dispose();
console.log('PASS land filtering runs off-thread, stale job cancelled, identical reflection bands');
