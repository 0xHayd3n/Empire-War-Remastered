// Score only a reviewer-selected visible terrain/shore window. Never classify the sky,
// HUD, unexplored areas or the entire frame as a bug for being intentionally dark.
const assert = require('node:assert/strict');
function darkIsland(image, rect, threshold = 14) {
  const [x0, y0, w, h] = rect,
    { data, width, height } = image;
  assert(w > 0 && h > 0 && x0 >= 0 && y0 >= 0 && x0 + w <= width && y0 + h <= height);
  const mask = new Uint8Array(w * h),
    q = new Int32Array(w * h);
  let dark = 0,
    largest = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = 4 * ((y + y0) * width + x + x0);
      if (Math.max(data[i], data[i + 1], data[i + 2]) < threshold) {
        dark++;
        mask[y * w + x] = 1;
      }
    }
  for (let i = 0; i < mask.length; i++)
    if (mask[i]) {
      let front = 0,
        tail = 1;
      q[0] = i;
      mask[i] = 0;
      const put = k => {
        if (mask[k]) {
          mask[k] = 0;
          q[tail++] = k;
        }
      };
      while (front < tail) {
        const p = q[front++],
          col = p % w;
        if (col > 0) put(p - 1);
        if (col < w - 1) put(p + 1);
        if (p >= w) put(p - w);
        if (p < mask.length - w) put(p + w);
      }
      largest = Math.max(largest, tail);
    }
  return { rect, threshold, dark, largest, fraction: largest / (w * h) };
}
function lakeWindow(both, bed, rect) {
  let changed = 0,
    black = 0;
  const [x, y, w, h] = rect;
  assert.equal(both.width, bed.width);
  assert.equal(both.height, bed.height);
  assert(x >= 0 && y >= 0 && x + w <= both.width && y + h <= both.height);
  for (let j = y; j < y + h; j++)
    for (let i = x; i < x + w; i++) {
      const off = 4 * (j * both.width + i),
        a = both.data,
        b = bed.data;
      if (Math.abs(a[off] - b[off]) + Math.abs(a[off + 1] - b[off + 1]) + Math.abs(a[off + 2] - b[off + 2]) <= 18) continue;
      changed++;
      if (Math.max(a[off], a[off + 1], a[off + 2]) < 15) black++;
    }
  assert(changed > w * h * 0.1, 'No visible water contribution');
  assert(black / changed < 0.03, 'Black sheet/border in the visible lake window');
  // A black bed and black water can be identical. A difference mask alone misses that failure.
  const island = darkIsland(both, rect, 15);
  assert(island.fraction < 0.03, 'Black sheet/bed occupies a connected region of the reviewed window');
  return { rect, changed, black, island };
}
// A mounted shader probe can be reused across maps using the same program, but not after an edit.
function mixedProbeFile() {
  const fs = require('node:fs'),
    path = require('node:path'),
    os = require('node:os'),
    hash = require('node:crypto').createHash('sha256');
  for (const file of ['game/terrain.js', 'gpu/programs.js', 'game/endor-blend.js', 'landlight.js', 'forestfloor.js', 'endor-tiles.js'])
    hash.update(fs.readFileSync(path.join(__dirname, '../../public/js', file)));
  const dir = path.join(os.tmpdir(), 'universal-map-remaster-v1', 'surface-probes');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, hash.digest('hex') + '.json');
}
module.exports = { darkIsland, lakeWindow, mixedProbeFile };
