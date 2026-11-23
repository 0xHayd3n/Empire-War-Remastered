import fs from 'node:fs';
import path from 'node:path';
import { steamLibraries } from './workshop-library.mjs';
import { decodePNG } from '../public/js/png.js';
import { thumb } from './universal-card-images.mjs';
// Optional official wordmark from the player's Steam client. Fixed app ID and filename,
// no remote fetch or Workshop writes; the mounted Republic crest is the offline fallback.
export async function swtorLogo(roots = steamLibraries()) {
  for (const root of roots) {
    const file = path.join(root, 'appcache', 'librarycache', '1286830', 'logo.png');
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.size > 2 * 1024 ** 2) continue;
      const b = fs.readFileSync(file);
      if (b.length < 33 || b.readUInt32BE(16) * b.readUInt32BE(20) > 2 * 1024 ** 2) continue;
      const src = await decodePNG(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
      if (!src) continue;
      let left = src.width,
        top = src.height,
        right = -1,
        bottom = -1;
      for (let y = 0; y < src.height; y++)
        for (let x = 0; x < src.width; x++) {
          if (src.data[4 * (y * src.width + x) + 3] < 12) continue;
          left = Math.min(x, left);
          right = Math.max(x, right);
          top = Math.min(y, top);
          bottom = Math.max(y, bottom);
        }
      if (right >= left) return thumb(src, { x: left, y: top, w: 1 + right - left, h: 1 + bottom - top });
    } catch {
      /* This optional artwork is not a campaign dependency. */
    }
  }
  return '';
}
