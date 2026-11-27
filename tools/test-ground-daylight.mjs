import assert from 'node:assert/strict';
import * as T from 'three';
import { soilColor, snapGroundGrid, nearGroundTarget, nearGroundFit } from '../public/js/game/groundday.js';
import { battlePrefs } from '../public/js/battlerealism.js';
const t = { size: 4, height: 1, layerIndex: [1, 0, 0, 1], layers: [{}, {}] },
  dds = (r, g, b) => ({ mipmaps: [{ width: 1, height: 1, data: new Uint8Array([r, g, b, 255]) }] });
assert.deepEqual(soilColor(t, [0, 1], [[dds(255, 0, 0)], [dds(0, 0, 255)]]), [0.5, 0.035, 0.5]);
assert.deepEqual(soilColor(t, [], []), [0.32, 0.32, 0.32]);
const c = new T.OrthographicCamera(-255, 255, 255, -255, 1, 3000),
  anchor = new T.Vector3(123, 187, 0),
  sun = new T.Vector3(1, 2, 3).normalize(),
  sample = new T.Vector3(50, 60, 30);
function fit(dx) {
  const at = anchor.clone();
  at.x += dx;
  c.position.copy(at).addScaledVector(sun, 800);
  c.up.set(0, 0, 1);
  c.lookAt(at);
  c.updateMatrixWorld();
  c.left = c.bottom = -255;
  c.right = c.top = 255;
  snapGroundGrid(c, 1024);
  return sample.clone().project(c);
}
const a = fit(0),
  b = fit(0.001),
  d = fit(2);
for (const k of ['x', 'y']) {
  assert(Math.abs(a[k] - b[k]) < 1e-8);
  const shift = (a[k] - d[k]) * 512;
  assert(Math.abs(shift - Math.round(shift)) < 1e-8);
}
const n = nearGroundTarget(1024);
nearGroundFit(n, c, anchor.x, anchor.y, 0, new T.Matrix4());
assert(n.params.x < (c.right - c.left) / 2048);
assert(n.params.y > 0 && n.params.z === 1 / 1024);
n.target.depthTexture.dispose();
n.target.dispose();
const prefs = { groundDaylight: false, battleRealism: 'on' };
assert(battlePrefs(prefs).groundDaylight);
prefs.battleRealism = 'off';
assert(!battlePrefs(prefs).groundDaylight);
prefs.battleRealism = 'custom';
assert(!battlePrefs(prefs).groundDaylight);
console.log(
  'Land daylight: layer coverage/fallback, stationary and integral shadow grid motion, finer near pitch, settings isolation passed.'
);
