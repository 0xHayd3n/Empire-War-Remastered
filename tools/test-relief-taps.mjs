// A diagnostic footprint enumerates all three donors. The live height path need
// only read the donors with support. Retain the exact transforms, even at seams.
import assert from 'node:assert/strict';
import { tileFootprint, scatteredHeight } from '../public/js/endor-tiles.js';
import { sampleHeight } from '../public/js/game/endor-relief.js';
const h = { size: 32, data: Uint8Array.from({ length: 1024 }, (_, i) => (i * 67 + (i >> 4) * 3) & 255) };
let taps = 0,
  expectedTaps = 0,
  all = 0;
for (const id of [0, 3, 7, 13])
  for (const regular of [false, true])
    for (let k = -1700; k < 1700; k++) {
      const u = k * 0.0617,
        v = (k % 91) * 0.43;
      const points = regular ? [[u, v, 1]] : tileFootprint(u, v, id);
      const ref = points.reduce((s, [x, y, w]) => s + w * sampleHeight(h, x, y), 0);
      const got = scatteredHeight(
        (h, x, y) => {
          taps++;
          return sampleHeight(h, x, y);
        },
        h,
        u,
        v,
        id,
        regular
      );
      assert.equal(got, ref, 'donor weights or transformed UV changed');
      expectedTaps += points.filter(p => p[2] > 0).length;
      all += points.length;
    }
console.log({ taps, expectedTaps, all });
assert.equal(taps, expectedTaps, 'zero-weight donor still sampled');
