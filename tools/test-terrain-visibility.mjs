// Brute-force triangle bounds vs the single trimmed range. Includes padded
// rectangular maps, empty rows, cliffs, transformed terrain and reflected views.
import * as T from '../public/vendor/three/build/three.module.js';
import { terrainBands } from '../public/js/game/terrain-visibility.js';
import assert from 'node:assert/strict';
for (const [w, h] of [
  [67, 102],
  [103, 65]
]) {
  const n = Math.max(w, h),
    heights = Float32Array.from({ length: n * n }, (_, i) => 48 * Math.sin(i * 0.031) + 0.3 * (i % n)),
    triAt = new Int32Array(2 * (w - 1) * (h - 1)).fill(-1),
    boxes = [];
  for (let y = 0; y < h - 1; y++)
    for (let x = 0; x < w - 1; x++) {
      if ((y >= 8 && y < 16) || (x + 5 * y) % 17 === 0) continue;
      const t = 2 * (y * (w - 1) + x),
        a = y * n + x;
      for (const [k, ids] of [
        [0, [a, a + 1, a + n + 1]],
        [1, [a, a + n + 1, a + n]]
      ]) {
        triAt[t + k] = 3 * boxes.length;
        const b = new T.Box3();
        for (const p of ids) b.expandByPoint(new T.Vector3((p % n) * 20, Math.floor(p / n) * 20, heights[p]));
        boxes.push(b);
      }
    }
  const total = boxes.length * 3,
    select = terrainBands({ width: w, height: h, size: n, heights }, triAt, total),
    fr = new T.Frustum(),
    m = new T.Matrix4();
  const worlds = [new T.Matrix4(), new T.Matrix4().makeRotationZ(0.18).setPosition(11, -31, 19)];
  let trimmed = 0;
  for (const world of worlds)
    for (let i = 0; i < 32; i++) {
      const c = i % 3 === 0 ? new T.OrthographicCamera(-120, 120, 80, -80, 0.5, 2200) : new T.PerspectiveCamera(50, 1.7, 1, 4200);
      const x = w * 10 + 700 * Math.sin(i * 0.71),
        y = h * 10 + 900 * Math.cos(i * 0.43),
        reflected = i % 4 === 0;
      c.up.set(0, 0, reflected ? -1 : 1);
      c.position.set(x + 85, y + 135, reflected ? -180 : 110 + 30 * (i % 6));
      c.lookAt(x, y, 5);
      c.updateMatrixWorld();
      if (reflected) {
        c.projectionMatrix.elements[2] += 0.12;
        c.projectionMatrix.elements[6] -= 0.08;
      }
      const r = {};
      select(c, world, r);
      fr.setFromProjectionMatrix(m.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse).multiply(world));
      assert(r.start % 3 === 0 && r.count % 3 === 0 && r.count >= 0 && r.start + r.count <= total);
      if (r.count < total * 0.6) trimmed++;
      for (let j = 0; j < boxes.length; j++)
        if (fr.intersectsBox(boxes[j])) assert(3 * j >= r.start && 3 * j + 3 <= r.start + r.count, 'culled a possibly visible triangle');
    }
  assert(trimmed > 12);
  const away = new T.PerspectiveCamera(40, 1, 1, 200);
  away.position.set(-200, -400, 5000);
  away.lookAt(-200, -400, 5500);
  away.updateMatrixWorld();
  const r = {};
  select(away, worlds[0], r);
  assert.equal(r.count, 0);
}
console.log('PASS rectangular and holed terrain, transformed, oblique and empty views; all intersecting triangles retained');
